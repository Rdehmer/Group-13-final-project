export type CustomerAddressFields = {
  service_address?: string | null;
  billing_address?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  region?: string | null;
  country?: string | null;
};

export type CustomerAddressForm = {
  service_address: string;
  billing_address: string;
  city: string;
  state: string;
  zip_code: string;
  region: string;
  country: string;
};

export function emptyToNull(value: string): string | null {
  const t = value.trim();
  return t.length > 0 ? t : null;
}

export function nonEmpty(value: string | null | undefined): string | null {
  if (value == null) return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

export function emptyCustomerAddressForm(): CustomerAddressForm {
  return {
    service_address: "",
    billing_address: "",
    city: "",
    state: "",
    zip_code: "",
    region: "",
    country: "",
  };
}

export function customerAddressFormFromCustomer(
  customer: Partial<CustomerAddressFields>,
): CustomerAddressForm {
  return {
    service_address: customer.service_address ?? "",
    billing_address: customer.billing_address ?? "",
    city: customer.city ?? "",
    state: customer.state ?? "",
    zip_code: customer.zip_code ?? "",
    region: customer.region ?? "",
    country: customer.country ?? "",
  };
}

export function buildCustomerAddressPayload(form: CustomerAddressForm): {
  service_address: string | null;
  billing_address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  region: string | null;
  country: string | null;
} {
  const street = emptyToNull(form.service_address);
  return {
    service_address: street,
    billing_address: emptyToNull(form.billing_address) ?? street,
    city: emptyToNull(form.city),
    state: emptyToNull(form.state),
    zip_code: emptyToNull(form.zip_code),
    region: emptyToNull(form.region),
    country: emptyToNull(form.country),
  };
}

export function formatCustomerAddress(
  customer: Partial<CustomerAddressFields>,
  fallback = "Address not provided",
): string {
  const street = nonEmpty(customer.service_address);
  const line2 = nonEmpty(customer.billing_address);
  const city = nonEmpty(customer.city);
  const state = nonEmpty(customer.state);
  const zip = nonEmpty(customer.zip_code);
  const region = nonEmpty(customer.region);
  const country = nonEmpty(customer.country);

  const streetLines = [street, line2 && line2 !== street ? line2 : null].filter(Boolean);
  const cityState = [city, state].filter(Boolean).join(", ");
  const cityStateZip = [cityState || null, zip].filter(Boolean).join(" ");

  const lines = [...streetLines, cityStateZip || null, region, country].filter(Boolean) as string[];
  return lines.length > 0 ? lines.join("\n") : fallback;
}

export function formatCustomerLocationLabel(customer: Partial<CustomerAddressFields>): string {
  return [nonEmpty(customer.city), nonEmpty(customer.state)].filter(Boolean).join(", ") || "—";
}

export function hasCustomerAddress(customer: Partial<CustomerAddressFields>): boolean {
  return formatCustomerAddress(customer, "") !== "";
}
