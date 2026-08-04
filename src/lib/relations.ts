export function relatedName(relation: unknown): string {
  if (!relation) return "—";
  if (Array.isArray(relation)) {
    const first = relation[0] as { name?: string } | undefined;
    return first?.name ?? "—";
  }
  if (typeof relation === "object" && relation !== null && "name" in relation) {
    return String((relation as { name: string }).name);
  }
  return "—";
}
