/**
 * WhatsApp drafts are sent through a third-party app and stay on the phones
 * involved, so they carry the reference only. Patient initials, the decision
 * and any clinical note stay inside the signed-in portal.
 */
export function updateNotice({ doctor, ref, sender }: { doctor: string; ref: string; sender: string }) {
  return `Dear Dr ${doctor}, there is an update on your BaraBridge referral ${ref}. Please sign in to BaraBridge, or open your private follow-up page, to view it. - ${sender}`;
}

export function openedNotice({ ref, team }: { ref: string; team?: string | null }) {
  return `Your referral ${ref} has been opened by the ${team || "receiving"} team. This is an opened receipt, not acceptance for transfer. Please use your secure portal for updates.`;
}
