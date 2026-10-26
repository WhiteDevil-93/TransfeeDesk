export const TEAMS = ["MEU", "TEU", "SEU"] as const;
export type Team = typeof TEAMS[number];
export const TEAM_NAMES: Record<Team, string> = {
  MEU: "Medical Emergency Unit", TEU: "Trauma Emergency Unit", SEU: "Surgical Emergency Unit",
};
export type Role = "admin" | "unit_admin" | "clinician" | "referrer";
export type Principal = { id: number; role: Role; team: Team | null };
export const canAccess = (u: Principal, team: string | null) =>
  u.role === "admin" || ((u.role === "unit_admin" || u.role === "clinician") && !!u.team && u.team === team);
export const canManage = (u: Principal, target: Principal) =>
  u.role === "admin" || (u.role === "unit_admin" && !!u.team && target.team === u.team && target.role === "clinician");
