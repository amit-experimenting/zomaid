-- Replace broken starter-pack YouTube URLs with verified working ones.
--
-- Background: an oEmbed audit on 2026-05-14 found that 48 of 50 video IDs in
-- 20260606_001_recipes_starter_pack_data_fill.sql return HTTP 404 from the
-- YouTube oEmbed endpoint. The IDs appear to have been hallucinated when the
-- starter-pack data-fill migration was authored.
--
-- This migration replaces every broken URL with a verified, public,
-- embeddable YouTube tutorial discovered via web search and confirmed via
-- `https://www.youtube.com/oembed?url=...&format=json` returning 200.
--
-- The two URLs that survived the audit are unchanged here:
--   - Fried Rice with Egg     v=qH__o17xHls
--   - Butter Chicken with Naan v=a03U45jFxOI
--
-- Section A — Singaporean / SE Asian starter recipes
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=Gn0kV6ZkIXA' where household_id is null and name = 'Kaya Toast with Soft-Boiled Eggs';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=zJi7h-nKngw' where household_id is null and name = 'Nasi Lemak';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=uIKq7g2NxXM' where household_id is null and name = 'Roti Prata with Dhal';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=jWVjz84Kq7w' where household_id is null and name = 'Mee Goreng';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=nIoIzarlQ1k' where household_id is null and name = 'Idli with Sambar';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=owQAHECibHc' where household_id is null and name = 'Bee Hoon Soup';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=OGyWCiavzsI' where household_id is null and name = 'Congee with Pork Floss';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=iLTwXOH-IMk' where household_id is null and name = 'Hainanese Chicken Rice';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=3kcLKZkCSgY' where household_id is null and name = 'Char Kway Teow';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=vdRbJAw2Qjc' where household_id is null and name = 'Laksa';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=460199Fo8zo' where household_id is null and name = 'Bak Kut Teh';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=1N2OckShujc' where household_id is null and name = 'Wonton Noodles';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=8tdjkDGCfvw' where household_id is null and name = 'Vegetable Briyani';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=VcuBiTl87Hc' where household_id is null and name = 'Hokkien Mee';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=SjMmiAOACKM' where household_id is null and name = 'Ondeh-Ondeh';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=qpiFatzP21Y' where household_id is null and name = 'Curry Puffs';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=uH1ltguPzBo' where household_id is null and name = 'Sambal Kangkong with Rice';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=NaiL0SeTz_s' where household_id is null and name = 'Steamed Fish with Ginger';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=L1i3doViWC8' where household_id is null and name = 'Black Pepper Beef';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=jQAtIrxguLI' where household_id is null and name = 'Dhal Curry with Roti';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=mtv21R1FwaQ' where household_id is null and name = 'Sweet & Sour Pork';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=CZEUn0CgN4Q' where household_id is null and name = 'Stir-fried Tofu and Vegetables';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=irHKAb2rqDE' where household_id is null and name = 'Chicken Curry with Rice';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=OAiK2UoEpqA' where household_id is null and name = 'Mee Soto';

-- Section B — Indian starter recipes
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=w7VyenvfNHo' where household_id is null and name = 'Masala Dosa';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=UXaOuBoatUA' where household_id is null and name = 'Poha';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=utYKlRIYyIU' where household_id is null and name = 'Upma';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=FWOuYyH4V5U' where household_id is null and name = 'Aloo Paratha';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=ygW0SxmDrMQ' where household_id is null and name = 'Medu Vada';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=Q80C11HkGBQ' where household_id is null and name = 'Pongal';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=asY7cq6j0xE' where household_id is null and name = 'Rajma Chawal';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=nnXgrA8H8xM' where household_id is null and name = 'Chole Bhature';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=cRsAQeR5dbI' where household_id is null and name = 'Palak Paneer with Rice';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=8XRpoWliwGM' where household_id is null and name = 'Veg Pulao';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=NQpnf7M5K7Y' where household_id is null and name = 'Sambar Rice';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=GBHgQYKLWAY' where household_id is null and name = 'Aloo Gobi with Roti';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=c6S9skegZ1c' where household_id is null and name = 'Curd Rice';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=GZl6N_bF1lo' where household_id is null and name = 'Samosa';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=mTVTI1SIkH0' where household_id is null and name = 'Pani Puri';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=c-hjrGHQyAs' where household_id is null and name = 'Bhel Puri';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=P_W5Tj6gEZQ' where household_id is null and name = 'Pakora';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=F4ls0vVjp4A' where household_id is null and name = 'Masala Chai with Biscuits';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=ZaUNzwr_KF0' where household_id is null and name = 'Paneer Tikka Masala';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=qfgL2hU6_3E' where household_id is null and name = 'Fish Curry';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=IC9VEIXVZ5s' where household_id is null and name = 'Mutton Rogan Josh';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=U-Km4u20cI8' where household_id is null and name = 'Baingan Bharta with Roti';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=1dec3Cs7LAY' where household_id is null and name = 'Kadai Paneer';
update public.recipes set youtube_url = 'https://www.youtube.com/watch?v=j1z9MWqmkIs' where household_id is null and name = 'Egg Curry with Rice';
