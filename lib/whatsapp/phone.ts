export function normalizePhoneNumber(input: string) {
  return input.replace(/\D/g, "");
}

export function isValidPhoneNumber(phone: string) {
  return /^\d{10,15}$/.test(phone);
}
