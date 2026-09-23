export type OperatorRole = "A2" | "A1";

export type Operator = { name: string; role: OperatorRole };

// Shared with the mic-check sign-off so a name typed once is used everywhere.
const NAME_KEY = "pulse-operator-name";
const ROLE_KEY = "pulse-operator-role";

export function loadOperator(): Operator {
  try {
    const name = window.localStorage.getItem(NAME_KEY)?.trim() ?? "";
    const role = window.localStorage.getItem(ROLE_KEY) === "A1" ? "A1" : "A2";
    return { name: name.slice(0, 60), role };
  } catch {
    return { name: "", role: "A2" };
  }
}

export function saveOperator(operator: Operator): void {
  try {
    window.localStorage.setItem(NAME_KEY, operator.name.trim().slice(0, 60));
    window.localStorage.setItem(ROLE_KEY, operator.role);
  } catch {
    // Identity stays in memory for this session when storage is unavailable.
  }
}

/** How an acknowledgement is attributed. An unnamed operator is recorded as such, never as someone. */
export function operatorLabel(operator: Operator): string {
  const name = operator.name.trim();
  return name ? `${name} (${operator.role})` : `Unnamed ${operator.role}`;
}
