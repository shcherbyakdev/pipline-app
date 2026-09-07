import { getTranslations } from "next-intl/server";
import type { Legal } from "@/features/payments/legal";

/* S2 (spec §Public): one muted line of identity, then the policy links —
   only what the studio filled in. Renders nothing for an empty object, so
   every org without legal details looks exactly as before. Sits under the
   language links on the channel page and the manage page. */
export async function LegalFooter({ legal }: { legal: Legal }) {
  const t = await getTranslations("public.legal");
  const identity = [legal.legalName, legal.address, legal.taxId ? t("taxId", { id: legal.taxId }) : null, legal.regNo ? t("regNo", { id: legal.regNo }) : null].filter(Boolean);
  const links = ([["termsUrl", "terms"], ["privacyUrl", "privacy"], ["refundUrl", "refund"]] as const).filter(([k]) => legal[k]);
  if (identity.length === 0 && links.length === 0) return null;
  return (
    <footer className="text-muted-foreground mt-2 flex flex-col gap-1 text-xs">
      {identity.length > 0 ? <p>{identity.join(" · ")}</p> : null}
      {links.length > 0 ? (
        <p className="flex flex-wrap gap-x-3">
          {links.map(([k, label]) => (
            <a key={k} href={legal[k]} target="_blank" rel="noopener" className="underline underline-offset-2">{t(label)}</a>
          ))}
        </p>
      ) : null}
    </footer>
  );
}
