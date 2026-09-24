// Secret type — branded string whose serialization is always [redacted]
// Per architecture plan section 22: secrets use a Secret type whose serialization is [redacted]

const SECRET_BRAND = Symbol("Secret");

/** A branded string type that redacts itself on serialization */
export class Secret {
  private readonly [SECRET_BRAND] = true as const;
  private readonly value: string;

  constructor(value: string) {
    this.value = value;
  }

  /** Get the raw value — only call this when actually sending to the provider */
  expose(): string {
    return this.value;
  }

  /** Always returns [redacted] */
  toString(): string {
    return "[redacted]";
  }

  /** Always returns "[redacted]" */
  toJSON(): string {
    return "[redacted]";
  }

  /** Prevent accidental logging */
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return "[redacted]";
  }

  /** Check if a value is a Secret */
  static isSecret(value: unknown): value is Secret {
    return value instanceof Secret;
  }

  /** Create from a raw string, or return null for empty */
  static from(value: string | null | undefined): Secret | null {
    if (!value || value.trim().length === 0) return null;
    return new Secret(value.trim());
  }
}
