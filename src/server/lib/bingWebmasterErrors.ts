export class BingWebmasterApiError extends Error {
  /** Bing's machine-readable ErrorCode number (e.g. 3 = InvalidApiKey). */
  constructor(
    public readonly status: number,
    message: string,
    public readonly errorCode?: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "BingWebmasterApiError";
  }
}

export class BingWebmasterTokenError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "BingWebmasterTokenError";
  }
}

export class BingWebmasterNotConnectedError extends Error {
  constructor(public readonly projectId: string) {
    super("Bing Webmaster is not connected for this project");
    this.name = "BingWebmasterNotConnectedError";
  }
}
