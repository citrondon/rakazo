import { spawn } from "node:child_process";

// Windows installs the tool shims as .cmd files, which spawn cannot execute without a shell.
const shell = process.platform === "win32";

export function runProcess(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env, shell });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
    });
  });
}
