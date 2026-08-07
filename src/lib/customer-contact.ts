export type CustomerContactFields = {
  primary_contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type CustomerContactForm = {
  primary_contact_name: string;
  email: string;
  phone: string;
};

export function customerContactFormFromCustomer(
  customer: Partial<CustomerContactFields>,
): CustomerContactForm {
  return {
    primary_contact_name: customer.primary_contact_name ?? "",
    email: customer.email ?? "",
    phone: customer.phone ?? "",
  };
}

export function validateCustomerContactForm(form: CustomerContactForm): string | null {
  const name = form.primary_contact_name.trim();
  const email = form.email.trim();
  const phone = form.phone.trim();

  if (!name && !email && !phone) {
    return "Enter at least a contact name, email, or phone number.";
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Enter a valid email address.";
  }

  return null;
}

export function buildCustomerContactPayload(form: CustomerContactForm): CustomerContactFields {
  return {
    primary_contact_name: form.primary_contact_name.trim() || null,
    email: form.email.trim() || null,
    phone: form.phone.trim() || null,
  };
}
