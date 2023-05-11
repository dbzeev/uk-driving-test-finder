# Practical Driving Test Finder

## The problem
* Manually finding a practical driving test date less than 6 months ahead is almost impossible.
* The reason for this is the large amount of bots running on DVSA's driving schools' website, by which it is easy to book bulks of driving test slots, leaving no free slots for legitimate users. 

## Purpose
* Given an existing test slot, automatically booking an earlier date, when it becomes available.
* Not abusing DVSA's website.

## What the application does
* Constantly looking for test slots in a date earlier then the current test date.
* Once a matching slot date is found, booking the latest hour.
* The booking slot should be:
    * At least a week ahead, to give enough time to prepare for the test.
    * In the x nearest test centers to a given post code, where 0 < x < 5.
    * (Optional) Outside a given holiday period.
    
## What the application doesn't do
* Letting the user approve the test slot that was found, before performing the booking.
* Immediately giving results. It can take several days to find a desirable test date, although it's getting much better with the ongoing development.  

## How to use:
* Obtain a 2Captcha token from [2captcha](https://www.2captcha.com) and input it in config.json.
* Input at least 1 item in profiles.js (can be any number of items).
* Running it: `node index.js`
