import { calPublicUrl } from "~/lib/booking/config";
import { canonicalUrl } from "~/lib/seo/url-policy";
import { meetingBookingLinkInput } from "~/lib/public-content/contracts";

/** Returns the existing public booking flow; does not contact a calendar or reserve a slot. */
export const getMeetingBookingLink = (args: unknown) => {
  const { language } = meetingBookingLinkInput.parse(args);
  return {
    status: "booking_link",
    bookingCreated: false,
    language,
    schedulerUrl: calPublicUrl(language),
    siteUrl: `${canonicalUrl(language === "en" ? "/en/contact/" : "/contact/")}#book`,
    userConfirmationRequired: true,
    instructions:
      language === "en"
        ? "Open the link to choose a meeting type and available time, enter your details and confirm in Cal.com. No meeting has been booked."
        : "Откройте ссылку, выберите тип встречи и доступное время, укажите свои данные и подтвердите запись в Cal.com. Встреча ещё не забронирована.",
  };
};
