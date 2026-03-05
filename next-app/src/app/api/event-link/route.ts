import { NextResponse } from "next/server";
import { createEventLink } from "../../../server/scheduler-pg";

export async function POST(req: Request) {
  const json = (await req.json()) as {
    subject?: string;
    eventTitle?: string;
    proposedDates?: string[];
    startHour?: string;
    endHour?: string;
  };
  const { status, body } = await createEventLink(json);
  return NextResponse.json(body, { status });
}

