export type OnboardingRow = {
  name: string;
  quantity: number;
  unit: string;
};

const CUSTOM_NAME_RE = /^custom_name_(\d+)$/;

function asNonEmptyString(v: FormDataEntryValue | null): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function parseOnboardingFormData(
  formData: FormData,
  starterNames: readonly string[],
): OnboardingRow[] {
  const out: OnboardingRow[] = [];

  for (const name of starterNames) {
    const qtyRaw = formData.get(`qty_${name}`);
    const unitRaw = formData.get(`unit_${name}`);
    const unit = asNonEmptyString(unitRaw);
    if (qtyRaw == null || unit == null) continue;
    const qty = Number(qtyRaw);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    out.push({ name, quantity: qty, unit });
  }

  const customIndices: number[] = [];
  for (const [key] of (formData as any).entries()) {
    const m = CUSTOM_NAME_RE.exec(key);
    if (m) customIndices.push(Number(m[1]));
  }
  customIndices.sort((a, b) => a - b);

  for (const i of customIndices) {
    const nameRaw = formData.get(`custom_name_${i}`);
    const qtyRaw = formData.get(`custom_qty_${i}`);
    const unitRaw = formData.get(`custom_unit_${i}`);
    const name = typeof nameRaw === "string" ? nameRaw.trim() : "";
    const unit = asNonEmptyString(unitRaw);
    if (name.length === 0 || unit == null || qtyRaw == null) continue;
    const qty = Number(qtyRaw);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    out.push({ name, quantity: qty, unit });
  }

  return out;
}
