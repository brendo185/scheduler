import { NextResponse } from "next/server";
import { getCalendarEvents } from "../../../server/scheduler";

export function GET() {
  const { status, body } = getCalendarEvents();
  return NextResponse.json(body, { status });
}

