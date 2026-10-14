import { useReviews } from "./hooks/use-reviews.js";
import { ReviewsScreen } from "./components/reviews-screen.js";
export function ReviewsApp() {
  return <ReviewsScreen {...useReviews()} />;
}
