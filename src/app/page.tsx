import { redirect } from "next/navigation";

/** The billing screen is home. Middleware sends signed-out users to /login. */
export default function Home() {
  redirect("/billing");
}
