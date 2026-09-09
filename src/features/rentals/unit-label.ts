/** "Space · Unit" for people — mail subjects, timeline tooltips. A space's
    first unit is named after the space (actions.ts createOffering) and stays
    that way while it's the only one (updateOffering), so a unit that merely
    repeats the space's name is noise: "Flat · Flat" reads as "Flat". */
export function withUnit(offeringName: string, unitName: string | null): string {
  return unitName && unitName !== offeringName ? `${offeringName} · ${unitName}` : offeringName;
}

/** S6: an equipment space's items are "<name> 2", "<name> 3"… The space's
    own name may already be at the 200-char ceiling rental_units_name_len
    allows, so the base is trimmed to leave room for the number. */
export function numberedUnitName(offeringName: string, n: number): string {
  const suffix = ` ${n}`;
  return `${offeringName.slice(0, 200 - suffix.length)}${suffix}`;
}
