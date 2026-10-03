/** Deliberately synthetic structural fixture, not a bundled current airline policy. */
export function fixture(small = '45 x 36 x 20', large = '56 x 45 x 25', mass = '15') {
  const smallSize = `Maximum size ${small}cm (including any handles and wheels)`;
  const largeSize = `Maximum size ${large} cm (including any handles and wheels)`;
  return `<main>
    Everyone can bring one small under seat cabin bag per person on board for free.
    ${smallSize} weigh up to ${mass}kg.
    If you'd also like to bring ${largeSize}. If you're an easyJet Plus member:
    maximum number of cabin bags available per person is two. Cabin bags explained
    All customers can bring on board: One small cabin bag ${smallSize}
    Needs to fit under the seat in front of you Maximum weight ${mass}kg
    Customers who have paid to add a large cabin bag or have easyJet Plus membership and have booked a large cabin bag
    One large cabin bag ${largeSize} Needs to fit in an overhead locker Maximum weight ${mass}kg subject to available space
    Your cabin bag allowance - All customers
    if you're auto-allocated an Up Front or Extra Legroom seat, your cabin bag allowance will be one small under seat cabin bag.
    easyJet Plus members: If you do not book a large cabin bag in advance hold free of charge
    Inclusive Plus Fare Your large cabin bag will be subject to available space on board.
    Your cabin bag allowance - easyJet Plus cardholders</main>`;
}
