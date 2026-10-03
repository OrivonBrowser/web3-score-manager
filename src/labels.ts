import type { Subject } from "./types.ts";

export const SCALE_MAX: Record<Subject, number> = { website: 4, operation: 5, connection: 3 };

const LABELS: Record<Subject, Record<number, string>> = {
  website: {
    1: "A standard website, without DDOC",
    2: "Supports DDOC",
    3: "Open source; runs no external code without the user's informed consent",
    4: "Trustless in all of its operations and external connections",
  },
  operation: {
    1: "Source code incomplete or not available; what happens cannot be known",
    2: "Source code available, and verifiably does what it promises",
    3: "Relies only on network contexts considered trustless enough",
    4: "No centralized or untrusted party can act against the user's interests",
    5: "Immutable and completely trustless",
  },
  connection: {
    1: "Relies on centralized parties; received data cannot be verified",
    2: "Received data can be verified against a trustless system",
    3: "Completely decentralized; no trust in centralized parties for availability",
  },
};

const PRIVACY: Record<Subject, string> = {
  website: "every activity, including connections and operations, is reasonably privacy preserving",
  operation: "reasonably untrackable and indecipherable without user consent",
  connection: "gives reasonable anonymity",
};

export function levelLabel(subject: Subject, level: number): string {
  return LABELS[subject][level] ?? "";
}

export function privacyLabel(subject: Subject): string {
  return PRIVACY[subject];
}
