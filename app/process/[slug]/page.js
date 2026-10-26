import Link from "next/link";
import { notFound } from "next/navigation";
import { getData } from "../../../lib/data-store.js";
import ProcessDetail from "../../../components/ProcessDetail.js";
import LogoutButton from "../../../components/LogoutButton.js";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const data = await getData();
  const process = data.processes.find((item) => item.slug === slug);
  return { title: process?.taskName || "Process Detail" };
}

export default async function ProcessDetailPage({ params }) {
  const { slug } = await params;
  const data = await getData();
  const process = data.processes.find((item) => item.slug === slug);
  if (!process) notFound();

  return (
    <main className="detail-shell">
      <div className="detail-actions">
        <Link className="back-link" href="/">Back to flow chart</Link>
        <LogoutButton />
      </div>
      <ProcessDetail process={process} />
    </main>
  );
}
