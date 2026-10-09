import { Footer, Header } from "@/components/header";
import { Providers } from "@/components/providers";

export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <Providers>
      <Header />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        {children}
      </main>
      <Footer />
    </Providers>
  );
}
