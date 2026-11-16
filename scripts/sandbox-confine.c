/* Drops privileges and installs a syscall denylist, then execs the checker.
 * Compiled statically so the jail does not need a host toolchain. */
#define _GNU_SOURCE
#include <errno.h>
#include <linux/audit.h>
#include <linux/capability.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>

static int capset_empty(void) {
  /* Drop the bounding set while CAP_SETPCAP is still held. Emptying the
   * effective set first makes later drops fail with EPERM. */
  for (int bit = 0; bit < 64; bit += 1) {
    if (prctl(PR_CAPBSET_DROP, bit, 0, 0, 0) != 0 && errno != EINVAL) return -1;
  }
  struct __user_cap_header_struct header = {
    .version = _LINUX_CAPABILITY_VERSION_3,
    .pid = 0,
  };
  struct __user_cap_data_struct data[2] = {0};
  if (syscall(SYS_capset, &header, data) != 0) return -1;
  return 0;
}

static struct sock_filter deny(int number) {
  struct sock_filter jump = BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, number, 0, 1);
  return jump;
}

static int install_seccomp(void) {
  /* Host-control calls. The filesystem and network namespaces are the boundary;
   * this stops the checker from undoing them. */
  const int blocked[] = {
    101, 155, 163, 165, 166, 167, 168, 169, 170, 171, 172, 173, 175, 176,
    179, 246, 248, 249, 250, 272, 298, 304, 308, 310, 311, 312, 313, 320,
    321, 428, 429, 430, 431, 432, 433, 442,
  };
  const int count = (int)(sizeof blocked / sizeof blocked[0]);
  struct sock_filter filter[96];
  int index = 0;
  filter[index++] = (struct sock_filter)BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch));
  filter[index++] = (struct sock_filter)BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_X86_64, 1, 0);
  filter[index++] = (struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS);
  filter[index++] = (struct sock_filter)BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr));
  for (int i = 0; i < count; i += 1) {
    filter[index++] = deny(blocked[i]);
    filter[index++] = (struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS);
  }
  filter[index++] = (struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW);
  struct sock_fprog program = { .len = (unsigned short)index, .filter = filter };
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) return -1;
  if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program) != 0) return -1;
  return 0;
}

int main(int argc, char **argv) {
  if (argc >= 4 && strcmp(argv[1], "--enter") == 0) {
    if (umount2(argv[2], MNT_DETACH) != 0) {
      fprintf(stderr, "confine: the host root could not be detached\n");
      return 85;
    }
    rmdir(argv[2]);
    argv += 2;
    argc -= 2;
  }
  if (argc < 2) {
    fprintf(stderr, "confine: missing command\n");
    return 81;
  }
  if (capset_empty() != 0) {
    fprintf(stderr, "confine: capabilities were not dropped\n");
    return 82;
  }
  if (install_seccomp() != 0) {
    fprintf(stderr, "confine: seccomp was not installed\n");
    return 83;
  }
  execv(argv[1], &argv[1]);
  fprintf(stderr, "confine: exec failed\n");
  return 84;
}
