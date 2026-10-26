import { z } from "zod";

const coordinate = (limit: number) => z.string().trim().min(1).regex(/^-?\d{1,3}(\.\d{1,8})?$/).refine(value => Number.isFinite(Number(value)) && Math.abs(Number(value)) <= limit, "Invalid coordinate");
export const latitude = coordinate(90);
export const longitude = coordinate(180);
export const facilityLocation = z.object({ lat: latitude, lon: longitude });
export type FacilityPoint = { lat: string; lon: string };
export type CatchmentResult = { status: "matched" | "outside"; border: [number, number][]; facilities: { name: string; location: [number, number] }[]; color: string; source: string };
