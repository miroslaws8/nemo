/** An error the API answers with its own status code (anything else is a 500). */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
