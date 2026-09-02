/** "Space · Unit" for people — mail subjects, timeline tooltips. A space's
    first unit is named after the space (actions.ts createOffering) and stays
    that way while it's the only one (updateOffering), so a unit that merely
    repeats the space's name is noise: "Flat · Flat" reads as "Flat". */
export function withUnit(offeringName: string, unitName: string | null): string {
  return unitName && unitName !== offeringName ? `${offeringName} · ${unitName}` : offeringName;
}
