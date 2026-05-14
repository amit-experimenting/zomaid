# Recipe image upload manifest

Every starter recipe ships with `photo_path = 'starter/<slug>.jpg'`. The
binary doesn't have to exist — the app renders `public/recipe-photo-placeholder.jpg`
when the path 404s. To replace the placeholder with a real photo:

1. Open the Supabase dashboard → **Storage → recipe-images-public**.
2. Navigate into the **`starter/`** folder (create it if missing).
3. Click **Upload file** and choose your JPG. **The filename must match the
   "Upload path" column below exactly**, including extension. The app falls
   back to the placeholder if the filename is wrong.
4. The new photo appears in the app on next page load — no migration, no
   redeploy.

Photos should be **landscape JPG, 1280×720 or larger, ≤300 KB** for fast
load. Re-use the same `<slug>.jpg` filename to overwrite an existing image.

---

## Breakfast (14)

| # | Recipe | Upload path |
|---|---|---|
| 1 | Kaya Toast with Soft-Boiled Eggs | `starter/kaya-toast-with-soft-boiled-eggs.jpg` |
| 2 | Nasi Lemak | `starter/nasi-lemak.jpg` |
| 3 | Roti Prata with Dhal | `starter/roti-prata-with-dhal.jpg` |
| 4 | Mee Goreng | `starter/mee-goreng.jpg` |
| 5 | Idli with Sambar | `starter/idli-with-sambar.jpg` |
| 6 | Bee Hoon Soup | `starter/bee-hoon-soup.jpg` |
| 7 | Congee with Pork Floss | `starter/congee-with-pork-floss.jpg` |
| 8 | Oats with Banana | `starter/oats-with-banana.jpg` |
| 9 | Masala Dosa | `starter/masala-dosa.jpg` |
| 10 | Poha | `starter/poha.jpg` |
| 11 | Upma | `starter/upma.jpg` |
| 12 | Aloo Paratha | `starter/aloo-paratha.jpg` |
| 13 | Medu Vada | `starter/medu-vada.jpg` |
| 14 | Pongal | `starter/pongal.jpg` |

## Lunch (15)

| # | Recipe | Upload path |
|---|---|---|
| 1 | Hainanese Chicken Rice | `starter/hainanese-chicken-rice.jpg` |
| 2 | Char Kway Teow | `starter/char-kway-teow.jpg` |
| 3 | Laksa | `starter/laksa.jpg` |
| 4 | Fried Rice with Egg | `starter/fried-rice-with-egg.jpg` |
| 5 | Bak Kut Teh | `starter/bak-kut-teh.jpg` |
| 6 | Wonton Noodles | `starter/wonton-noodles.jpg` |
| 7 | Vegetable Briyani | `starter/vegetable-briyani.jpg` |
| 8 | Hokkien Mee | `starter/hokkien-mee.jpg` |
| 9 | Rajma Chawal | `starter/rajma-chawal.jpg` |
| 10 | Chole Bhature | `starter/chole-bhature.jpg` |
| 11 | Palak Paneer with Rice | `starter/palak-paneer-with-rice.jpg` |
| 12 | Veg Pulao | `starter/veg-pulao.jpg` |
| 13 | Sambar Rice | `starter/sambar-rice.jpg` |
| 14 | Aloo Gobi with Roti | `starter/aloo-gobi-with-roti.jpg` |
| 15 | Curd Rice | `starter/curd-rice.jpg` |

## Snacks (11)

| # | Recipe | Upload path |
|---|---|---|
| 1 | Ondeh-Ondeh | `starter/ondeh-ondeh.jpg` |
| 2 | Kueh Lapis | `starter/kueh-lapis.jpg` |
| 3 | Fresh Fruit Bowl | `starter/fresh-fruit-bowl.jpg` |
| 4 | Curry Puffs | `starter/curry-puffs.jpg` |
| 5 | Coconut Pancakes | `starter/coconut-pancakes.jpg` |
| 6 | Yam Cake | `starter/yam-cake.jpg` |
| 7 | Samosa | `starter/samosa.jpg` |
| 8 | Pani Puri | `starter/pani-puri.jpg` |
| 9 | Bhel Puri | `starter/bhel-puri.jpg` |
| 10 | Pakora | `starter/pakora.jpg` |
| 11 | Masala Chai with Biscuits | `starter/masala-chai-with-biscuits.jpg` |

## Dinner (15)

| # | Recipe | Upload path |
|---|---|---|
| 1 | Sambal Kangkong with Rice | `starter/sambal-kangkong-with-rice.jpg` |
| 2 | Steamed Fish with Ginger | `starter/steamed-fish-with-ginger.jpg` |
| 3 | Black Pepper Beef | `starter/black-pepper-beef.jpg` |
| 4 | Dhal Curry with Roti | `starter/dhal-curry-with-roti.jpg` |
| 5 | Sweet & Sour Pork | `starter/sweet-and-sour-pork.jpg` |
| 6 | Stir-fried Tofu and Vegetables | `starter/stir-fried-tofu-and-vegetables.jpg` |
| 7 | Chicken Curry with Rice | `starter/chicken-curry-with-rice.jpg` |
| 8 | Mee Soto | `starter/mee-soto.jpg` |
| 9 | Butter Chicken with Naan | `starter/butter-chicken-with-naan.jpg` |
| 10 | Paneer Tikka Masala | `starter/paneer-tikka-masala.jpg` |
| 11 | Fish Curry | `starter/fish-curry.jpg` |
| 12 | Mutton Rogan Josh | `starter/mutton-rogan-josh.jpg` |
| 13 | Baingan Bharta with Roti | `starter/baingan-bharta-with-roti.jpg` |
| 14 | Kadai Paneer | `starter/kadai-paneer.jpg` |
| 15 | Egg Curry with Rice | `starter/egg-curry-with-rice.jpg` |
