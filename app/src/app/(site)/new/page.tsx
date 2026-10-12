import { redirect } from "next/navigation";

// A campaign is opened at the curator's desk in the museum now.
export default function NewCampaign() {
  redirect("/?design=1");
}
