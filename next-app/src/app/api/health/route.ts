import { NextResponse } from "next/server";
import { getHealth } from "../../../server/scheduler-pg";

export function GET() {
  const { status, body } = getHealth();
  return NextResponse.json(body, { status });
}

