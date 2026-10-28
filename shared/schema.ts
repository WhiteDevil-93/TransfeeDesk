import { z } from "zod";
import { TEAMS, type Team, type Role } from "./teams";
import { latitude, longitude } from "./location";
export const imageInput = z.object({
  name: z.string().max(100), mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
  data: z.string().max(2800000),
});
export const referralInput = z.object({
  team: z.enum(TEAMS), consultType: z.enum(["transfer", "advice"]).default("transfer"),
  images: z.array(imageInput).max(3).default([]),
  doctorName: z.string().min(2), hospital: z.string().min(2), department: z.string().optional().default(""),
  phone: z.string().min(9), email: z.string().optional().default(""),
  specialty: z.string().default(""), currentLocation: z.string().optional().default(""), bedNeeded: z.string().optional().default(""),
  lat: latitude, lon: longitude,
  patientInitials: z.string().min(1), age: z.string().min(1), sex: z.string().min(1), folderNo: z.string().optional().default(""),
  diagnosis: z.string().min(2), history: z.string().min(5).max(5000), exam: z.string().min(5).max(5000), investigations: z.string().min(2).max(5000),
  reason: z.string().min(2).max(2000), suggestedPriority: z.enum(["P1","P2","P3"]),
  consent: z.literal(true),
});
export type ReferralInput = z.infer<typeof referralInput>;
export type Status = "pending"|"accepted"|"declined"|"waiting"|"advised";
export type Referral = Omit<ReferralInput, "team" | "images"> & { team: Team | null; images?: ImageAttachment[]; openedAt?: string|null; openedBy?: string; latestFollowupAt?: string|null; awaitingInfoAt?: string|null; followupSeenAt?: string|null; purgedAt?: string|null; locSource?: string; id:number; ref:string; createdAt:string; priority:"P1"|"P2"|"P3"; status:Status; decisionNote:string; decidedBy:string; decidedAt:string|null;
  bedStatus:string; bedWard:string; remindAt:string|null; ackBy:string; ackAt:string|null; referrerId?:number|null };
export const decisionInput = z.object({ team: z.enum(TEAMS).optional(), status: z.enum(["pending","accepted","declined","waiting","advised"]).optional(), priority: z.enum(["P1","P2","P3"]).optional(),
  decisionNote: z.string().max(5000).optional(), decidedBy: z.string().optional(), bedStatus: z.string().optional(), bedWard: z.string().optional(),
  remindAt: z.string().nullable().optional(), ack: z.string().optional(), ackVia: z.enum(["alarm","case"]).optional(),
  lat: z.string().regex(/^-?\d{1,3}(\.\d{1,8})?$/).optional(), lon: z.string().regex(/^-?\d{1,3}(\.\d{1,8})?$/).optional(), locSource: z.string().max(200).optional() });
export type Doctor = { doctorName:string; hospital:string; department:string; phone:string; email:string; count:number; last:string };
export type RosterContact = { name:string; role:string; phone:string; hash:string; email:string };
export type RosterEntry = { role:string; text:string; contacts:RosterContact[] };
export type RosterSpec = { id:string; name:string; group:string; period:string; notes:string[]; entries:RosterEntry[] };
export type User = { id:number; username:string; name:string; role:Role; team:Team|null; phone:string; active:boolean; mustChange:boolean; lastLogin:string|null;
  email?:string; specialty?:string; profession?:string|null; hpcsaNumber?:string; verifyStatus?:string; hasCard?:boolean };
export type AuditRow = { id:number; at:string; userName:string; action:string; referralId:number|null; detail:string; ip:string };
export type AppSettings = { p1:number; p2:number; p3:number; repeat:number; escalate:number; sound:boolean; retentionDays:number; responsibleParty:string; infoOfficer:string; infoOfficerEmail:string; infoOfficerPhone:string };
export type ImageAttachment = { id:number; name:string; mime:string; data?:string; createdAt:string; followupId:number|null };
export type Followup = { id:number; createdAt:string; author:string; kind:"update"|"advice"|"decision"|"question"|"reply"; body:string; images?:ImageAttachment[] };
export const followupInput = z.object({ ref:z.string().max(30).optional(), code:z.string().max(100).optional(), body:z.string().min(2).max(5000), images:z.array(imageInput).max(3).default([]) });
export const questionInput = z.object({ body:z.string().trim().min(2).max(2000) });
const pushKey = z.string().min(8).max(200).regex(/^[A-Za-z0-9_-]+={0,2}$/);
export const pushSubscriptionInput = z.object({ subscription:z.object({ endpoint:z.string().url().max(1000), keys:z.object({ p256dh:pushKey, auth:pushKey }) }) });
