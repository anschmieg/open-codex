import type { ExecResult } from "./interface.js";
import type { AppConfig } from "../../config.js";
import type { SpawnOptions } from "child_process";

import { exec } from "./raw-exec.js";
import { log } from "../../logger/log.js";

function getCommonRoots() {
  return [
    // Without this root, it'll cause:
    // pyenv: cannot rehash: $HOME/.pyenv/shims isn't writable
    `${process.env["HOME"]}/.pyenv`,
  ];
}

/**
 * When working with `sandbox-exec`, only consider `sandbox-exec` in `/usr/bin`
 * to defend against an attacker trying to inject a malicious version on the
 * PATH. If /usr/bin/sandbox-exec has been tampered with, then the attacker
 * already has root access.
 */
export const PATH_TO_SEATBELT_EXECUTABLE = "/usr/bin/sandbox-exec";

export function execWithSeatbelt(
  cmd: Array<string>,
  opts: SpawnOptions,
  writableRoots: ReadonlyArray<string>,
  config: AppConfig,
  abortSignal?: AbortSignal,
): Promise<ExecResult> {
  let scopedWritePolicy: string;
  let policyTemplateParams: Array<string>;

  const fullWritableRoots = [...writableRoots, ...getCommonRoots()];
  // In practice, fullWritableRoots will be non-empty, but we check just in
  // case the logic to build up fullWritableRoots changes.
  if (fullWritableRoots.length > 0) {
    const { policies, params } = fullWritableRoots
      .map((root, index) => ({
        policy: `(subpath (param "WRITABLE_ROOT_${index}"))`,
        // the kernel resolves symlinks before handing them to seatbelt for checking
        // so store the canonicalized form in the policy to be compared against
        param: `-DWRITABLE_ROOT_${index}=${realpathSync(root)}`,
      }))
      .reduce(
        (
          acc: { policies: Array<string>; params: Array<string> },
          { policy, param },
        ) => {
          acc.policies.push(policy);
          acc.params.push(param);
          return acc;
        },
        { policies: [], params: [] },
      );

    scopedWritePolicy = `\n(allow file-write*\n${policies.join(" ")}\n)`;
    policyTemplateParams = params;
  } else {
    scopedWritePolicy = "";
    policyTemplateParams = [];
  }

  const fullPolicy = READ_ONLY_SEATBELT_POLICY + scopedWritePolicy;
  log(
    `Running seatbelt with policy: ${fullPolicy} and ${
      policyTemplateParams.length
    } template params: ${policyTemplateParams.join(", ")}`,
  );

  const fullCommand = [
    PATH_TO_SEATBELT_EXECUTABLE,
    "-p",
    fullPolicy,
    ...policyTemplateParams,
    "--",
    ...cmd,
  ];
  return exec(fullCommand, opts, config, abortSignal);
}

const READ_ONLY_SEATBELT_POLICY = `
(version 1)

; inspired by Chrome's sandbox policy:
; https://source.chromium.org/chromium/chromium/src/+/main:sandbox/policy/mac/common.sb;l=273-319;drc=7b3962fe2e5fc9e2ee58000dc8fbf3429d84d3bd

; start with closed-by-default
(deny default)

; allow read-only file operations
(allow file-read*)

; child processes inherit the policy of their parent
(allow process-exec)
(allow process-fork)
(allow signal (target self))

(allow file-write-data
  (require-all
    (path "/dev/null")
    (vnode-type CHARACTER-DEVICE)))

; sysctls permitted.
(allow sysctl-read
  (sysctl-name "hw.activecpu")
  (sysctl-name "hw.busfrequency_compat")
  (sysctl-name "hw.byteorder")
  (sysctl-name "hw.cacheconfig")
  (sysctl-name "hw.cachelinesize_compat")
  (sysctl-name "hw.cpufamily")
  (sysctl-name "hw.cpufrequency_compat")
  (sysctl-name "hw.cputype")
  (sysctl-name "hw.l1dcachesize_compat")
  (sysctl-name "hw.l1icachesize_compat")
  (sysctl-name "hw.l2cachesize_compat")
  (sysctl-name "hw.l3cachesize_compat")
  (sysctl-name "hw.logicalcpu_max")
  (sysctl-name "hw.machine")
  (sysctl-name "hw.ncpu")
  (sysctl-name "hw.nperflevels")
  (sysctl-name "hw.optional.arm.FEAT_BF16")
  (sysctl-name "hw.optional.arm.FEAT_DotProd")
  (sysctl-name "hw.optional.arm.FEAT_FCMA")
  (sysctl-name "hw.optional.arm.FEAT_FHM")
  (sysctl-name "hw.optional.arm.FEAT_FP16")
  (sysctl-name "hw.optional.arm.FEAT_I8MM")
  (sysctl-name "hw.optional.arm.FEAT_JSCVT")
  (sysctl-name "hw.optional.arm.FEAT_LSE")
  (sysctl-name "hw.optional.arm.FEAT_RDM")
  (sysctl-name "hw.optional.arm.FEAT_SHA512")
  (sysctl-name "hw.optional.armv8_2_sha512")
  (sysctl-name "hw.memsize")
  (sysctl-name "hw.pagesize")
  (sysctl-name "hw.packages")
  (sysctl-name "hw.pagesize_compat")
  (sysctl-name "hw.physicalcpu_max")
  (sysctl-name "hw.tbfrequency_compat")
  (sysctl-name "hw.vectorunit")
  (sysctl-name "kern.hostname")
  (sysctl-name "kern.maxfilesperproc")
  (sysctl-name "kern.osproductversion")
  (sysctl-name "kern.osrelease")
  (sysctl-name "kern.ostype")
  (sysctl-name "kern.osvariant_status")
  (sysctl-name "kern.osversion")
  (sysctl-name "kern.secure_kernel")
  (sysctl-name "kern.usrstack64")
  (sysctl-name "kern.version")
  (sysctl-name "sysctl.proc_cputype")
  (sysctl-name-prefix "hw.perflevel")
)`.trim();
