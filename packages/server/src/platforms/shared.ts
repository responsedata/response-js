export type HeaderReader = {
  get(name: string): string | null;
};

export type NetworkEvidence = {
  asn?: number;
  city?: string;
  continent?: string;
  country?: string;
  organization?: string;
  region?: string;
  regionCode?: string;
  source: "cloudflare" | "vercel";
  timezone?: string;
};

export type PlatformEvidence = {
  cloudflare?: Record<string, unknown>;
  network?: NetworkEvidence;
  transport?: Record<string, unknown>;
};

export const sanitizeString = (value: string, maximumLength: number) => {
  let sanitized = "";
  for (let index = 0; index < value.length; index += 1) {
    if (sanitized.length === maximumLength) {
      break;
    }
    const codeUnit = value.charCodeAt(index);
    if (codeUnit === 0) {
      continue;
    }
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) {
        continue;
      }
      if (sanitized.length + 2 > maximumLength) {
        break;
      }
      sanitized += value.slice(index, index + 2);
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      continue;
    }
    sanitized += value[index];
  }

  return sanitized;
};

export const boundedString = (value: unknown, maximumLength: number) => {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  const sanitized = sanitizeString(value, maximumLength);
  return sanitized || undefined;
};

export const boundedInteger = (
  value: unknown,
  minimum: number,
  maximum: number,
) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= minimum &&
  value <= maximum
    ? value
    : undefined;

export const boundedIntegerArray = (value: unknown, maximumItems: number) => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const integers = value
    .filter(
      (item): item is number =>
        typeof item === "number" &&
        Number.isSafeInteger(item) &&
        item >= 0,
    )
    .slice(0, maximumItems);
  return integers.length > 0 ? integers : undefined;
};

export const compact = <Value extends Record<string, unknown>>(value: Value) =>
  Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<Value>;

export const hasValues = (value: object) => Object.keys(value).length > 0;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const decodeHeader = (value: string | null, maximumLength: number) => {
  if (!value) {
    return undefined;
  }

  try {
    return boundedString(decodeURIComponent(value), maximumLength);
  } catch {
    return boundedString(value, maximumLength);
  }
};
