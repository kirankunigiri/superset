import { type ChildProcess, spawn } from "node:child_process";

const DEFAULT_PORT = 4096;
const STARTUP_TIMEOUT_MS = 15_000;

interface OpenCodeInstance {
	process: ChildProcess;
	port: number;
	cwd: string;
}

class OpenCodeManager {
	#instances = new Map<string, OpenCodeInstance>();
	#launching = new Map<string, Promise<string>>();

	async ensureRunning(cwd: string): Promise<string> {
		const existing = this.#instances.get(cwd);
		if (existing && existing.process.exitCode === null) {
			return this.#buildUrl(existing.port, cwd);
		}

		if (await this.#isAlreadyRunning()) {
			return this.#buildUrl(DEFAULT_PORT, cwd);
		}

		const pending = this.#launching.get(cwd);
		if (pending) return pending;

		const promise = this.#launch(cwd);
		this.#launching.set(cwd, promise);
		try {
			return await promise;
		} finally {
			this.#launching.delete(cwd);
		}
	}

	#buildUrl(port: number, cwd: string): string {
		const projectPath = Buffer.from(cwd).toString("base64url");
		return `http://localhost:${port}/${projectPath}`;
	}

	async #isAlreadyRunning(): Promise<boolean> {
		try {
			const resp = await fetch(`http://localhost:${DEFAULT_PORT}/session`, {
				signal: AbortSignal.timeout(2000),
			});
			return resp.ok || resp.status === 404;
		} catch {
			return false;
		}
	}

	async #launch(cwd: string): Promise<string> {
		const child = spawn("opencode", ["web", "--port", String(DEFAULT_PORT)], {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env },
		});

		return new Promise<string>((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error("OpenCode web startup timed out (15s)"));
			}, STARTUP_TIMEOUT_MS);

			const checkReady = async () => {
				if (await this.#isAlreadyRunning()) {
					clearTimeout(timeout);
					this.#instances.set(cwd, {
						process: child,
						port: DEFAULT_PORT,
						cwd,
					});
					resolve(this.#buildUrl(DEFAULT_PORT, cwd));
					return true;
				}
				return false;
			};

			const poll = setInterval(async () => {
				if (await checkReady()) {
					clearInterval(poll);
				}
			}, 500);

			child.on("error", (err) => {
				clearTimeout(timeout);
				clearInterval(poll);
				reject(err);
			});

			child.on("exit", (code) => {
				this.#instances.delete(cwd);
				clearTimeout(timeout);
				clearInterval(poll);
				reject(
					new Error(`opencode web exited with code ${code} before serving`),
				);
			});
		});
	}

	stop(cwd: string): void {
		const instance = this.#instances.get(cwd);
		if (!instance) return;
		instance.process.kill();
		this.#instances.delete(cwd);
	}

	stopAll(): void {
		for (const [cwd, instance] of this.#instances) {
			instance.process.kill();
			this.#instances.delete(cwd);
		}
	}
}

let manager: OpenCodeManager | null = null;

export function getOpenCodeManager(): OpenCodeManager {
	if (!manager) manager = new OpenCodeManager();
	return manager;
}
