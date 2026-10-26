import FlowExplorer from "../components/FlowExplorer.js";
import { getData } from "../lib/data-store.js";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const data = await getData();
  return <FlowExplorer initialData={data} />;
}
