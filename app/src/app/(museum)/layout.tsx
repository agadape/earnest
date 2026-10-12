import { Header } from "@/components/header";
import { Providers } from "@/components/providers";

// The museum fills whatever the header leaves of the window, so it has no page column and no
// footer of its own. Everything else lives in `(site)/layout.tsx`.
export default function MuseumLayout({ children }: LayoutProps<"/">) {
  return (
    <Providers>
      <Header />
      <main className="relative min-h-[32rem] flex-1">{children}</main>
    </Providers>
  );
}
