export class YandexWebmasterApiError extends Error {
  /** Yandex's machine-readable error_code (e.g. HOST_NOT_VERIFIED). */
  constructor(
    public readonly status: number,
    message: string,
    public readonly errorCode?: string,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "YandexWebmasterApiError";
  }
}

export class YandexWebmasterTokenError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "YandexWebmasterTokenError";
  }
}

export class YandexWebmasterNotConnectedError extends Error {
  constructor(public readonly projectId: string) {
    super("Yandex Webmaster is not connected for this project");
    this.name = "YandexWebmasterNotConnectedError";
  }
}
