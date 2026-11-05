import type { Subject } from "./types.ts";

export const SCALE_MAX: Record<Subject, number> = { website: 4, operation: 5, connection: 3, integration: 4 };

const LABELS: Record<Subject, Record<number, string>> = {
  website: {
    1: "A standard website, without DDOC",
    2: "Supports DDOC",
    3: "Open source; runs no external code without the user's willing, aware consent",
    4: "Trustless operations (Level 4) and connections (Level 2), relying on no server, except optional parts the user knowingly starts",
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
  integration: {
    1: "Part of what it runs or shows comes from outside what was pinned, so it cannot be checked",
    2: "Everything it runs is pinned and can be checked; its source is not public",
    3: "Open source and runs only what it was pinned with; relies on a server or on data nothing checks",
    4: "Open source, trustless operations and checked connections, relying on no server except optional parts the user knowingly starts",
  },
};

const PRIVACY: Record<Subject, string> = {
  website: "every activity, including connections and operations, is privacy preserving; no connection shows the user to another party, even with consent",
  operation: "reasonably untrackable and indecipherable without user consent",
  connection: "gives reasonable anonymity",
  integration: "no connection it causes shows the user to another party, even with consent",
};

/** The mark Orivon draws for a level on the website and integration scales: Web2 for 1, Web2.5 for 2 and 3, Web3 for 4. */
export function gradeOf(level: number): string {
  return level <= 1 ? "Web2" : level <= 3 ? "Web2.5" : "Web3";
}

export function levelLabel(subject: Subject, level: number): string {
  return LABELS[subject][level] ?? "";
}

export function privacyLabel(subject: Subject): string {
  return PRIVACY[subject];
}
