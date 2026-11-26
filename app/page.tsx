import HomePageClient from "@/components/home-page-client";
import { getUpcomingConcerts } from "@/lib/upcoming-concerts";
import { withTicketUrls } from "@/lib/tickets-public";

export const dynamic = "force-dynamic";

// null = fetch error or nothing upcoming → section hidden (same rule as /esemenyek)
// Ticket CTA: the on-sale annotation decides per concert (fail-closed in the lib).
export default async function HomePage() {
  const upcomingConcerts = await getUpcomingConcerts();
  const displayedUpcoming =
    upcomingConcerts && upcomingConcerts.length > 0
      ? await withTicketUrls(upcomingConcerts)
      : null;
  return <HomePageClient upcomingConcerts={displayedUpcoming} />;
}