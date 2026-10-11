import HomePageClient from "@/components/home-page-client";
import { getUpcomingConcerts } from "@/lib/upcoming-concerts";

export const dynamic = "force-dynamic";

// null = fetch error or nothing upcoming → section hidden (same rule as /esemenyek)
export default async function HomePage() {
  const upcomingConcerts = await getUpcomingConcerts();
  const displayedUpcoming =
    upcomingConcerts && upcomingConcerts.length > 0 ? upcomingConcerts : null;
  return <HomePageClient upcomingConcerts={displayedUpcoming} />;
}