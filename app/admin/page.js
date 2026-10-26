import AdminPanel from "../../components/AdminPanel.js";
import { getData } from "../../lib/data-store.js";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const data = await getData();
  return <AdminPanel initialData={data} />;
}
