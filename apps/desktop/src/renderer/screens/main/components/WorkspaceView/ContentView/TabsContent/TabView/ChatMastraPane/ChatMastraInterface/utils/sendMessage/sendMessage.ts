export type ChatSendMessageInput = {
	payload: {
		content: string;
		images?: Array<{ data: string; mimeType: string }>;
	};
	metadata: {
		model?: string;
	};
};

function toBaseErrorMessage(error: unknown): string {
	if (typeof error === "string" && error.trim().length > 0) return error;
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message;
	}
	return "Failed to send message";
}

function isLikelyAuthErrorMessage(message: string): boolean {
	const normalizedMessage = message.toLowerCase();
	return (
		normalizedMessage.includes("oauth") ||
		normalizedMessage.includes("invalid bearer token") ||
		normalizedMessage.includes("invalid x-api-key") ||
		normalizedMessage.includes("invalid api key") ||
		normalizedMessage.includes("api key is missing") ||
		(normalizedMessage.includes("anthropic") &&
			(normalizedMessage.includes("api key") ||
				normalizedMessage.includes("bearer token"))) ||
		(normalizedMessage.includes("openai") &&
			(normalizedMessage.includes("api key") ||
				normalizedMessage.includes("bearer token")))
	);
}

export function toSendFailureMessage(error: unknown): string {
	const baseMessage = toBaseErrorMessage(error);
	if (!isLikelyAuthErrorMessage(baseMessage)) return baseMessage;
	return "Model authentication failed. Reconnect OAuth or set an API key in the model picker, then retry.";
}

export async function sendMessageOnce<T>(send: () => Promise<T>): Promise<T> {
	return send();
}
