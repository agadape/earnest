import { redirect } from "next/navigation";

// The catalog is the campaign board by the museum's door now.
export default function Catalog() {
  redirect("/?board=1");
}
