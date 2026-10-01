/* Add future demo or production profiles to this object using the same fields. */
window.priceMarketBusinesses = {
  "keystone-pizza": {
    demo: true,
    name: "Keystone Pizza Co.",
    avatarText: "KP",
    logoImage: "",
    heroImage: {
      src: "assets/showcase-restaurant.jpg",
      alt: "Wood-fired pizza in a welcoming neighborhood restaurant"
    },
    category: "Restaurant / Pizza",
    city: "Mechanicsburg",
    state: "PA",
    address: "1250 Market Street, Mechanicsburg, PA 17055",
    description: "Wood-fired pizza, fresh ingredients, local flavor, and weekly family deals. A neighborhood favorite for easy weeknights and good company.",
    phone: "717-555-0199",
    email: "hello@keystonepizza.example",
    website: {
      label: "keystonepizza.example",
      href: "https://example.com"
    },
    hours: [
      { days: "Monday – Thursday", time: "11 AM – 10 PM" },
      { days: "Friday – Saturday", time: "11 AM – 11 PM" },
      { days: "Sunday", time: "12 PM – 9 PM" }
    ],
    deals: [
      { title: "2 Large Pizzas — $24.99", description: "Perfect for family night. Available Monday through Thursday." },
      { title: "Free Garlic Knots", description: "Get free garlic knots with any online order over $30." },
      { title: "Lunch Slice Combo", description: "Two slices and a drink for $8.99 from 11 AM to 2 PM." }
    ],
    jobs: [
      { title: "Delivery Driver", detail: "Part-time evenings · Flexible hours · Great for students" },
      { title: "Pizza Cook", detail: "Full-time or part-time kitchen role · Experience preferred" },
      { title: "Cashier", detail: "Friendly front-counter team member for nights and weekends" }
    ],
    happyHours: [
      {
        title: "Weeknight Slice & Soda",
        description: "A cheese slice and fountain drink for $5.",
        days: "Monday – Thursday",
        startTime: "16:00",
        endTime: "18:00",
        restrictions: "Dine-in only. While supplies last."
      }
    ],
    gallery: [
      { src: "assets/showcase-restaurant.jpg", alt: "Freshly baked pizza in a wood-fired neighborhood restaurant", caption: "A neighborhood favorite" },
      { src: "assets/profile-pizza-oven.jpg", alt: "Pepperoni pizza fresh from the brick oven", caption: "Straight from the oven" },
      { src: "assets/profile-garlic-knots.jpg", alt: "Herbed garlic knots served with marinara", caption: "Made for sharing" }
    ]
  }
};

