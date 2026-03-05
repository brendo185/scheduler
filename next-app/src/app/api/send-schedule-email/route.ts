import { NextResponse } from "next/server";
import { sendScheduleEmail } from "../../../server/scheduler-pg";

export async function POST(req: Request) {
  const json = (await req.json()) as {
    to: string;
    subject?: string;
    eventTitle?: string;
    recipientName?: string;
    proposedDates?: string[];
    body?: string;
  };

  const { status, body } = await sendScheduleEmail({
    to: json.to,
    subject: json.subject,
    eventTitle: json.eventTitle,
    recipientName: json.recipientName,
    proposedDates: json.proposedDates,
    messageBody: json.body,
  });
  return NextResponse.json(body, { status });
}

