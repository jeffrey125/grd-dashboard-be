import {
  isPossiblePhoneNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';
import validator from 'validator';
import { z } from 'zod';

export const countryCodeSchema = z
  .string()
  .refine(validator.isISO31661Alpha2, 'Enter a valid ISO 3166-1 country code');

export const currencyCodeSchema = z
  .string()
  .refine(validator.isISO4217, 'Enter a valid ISO 4217 currency code');

export function isPossibleAddressPhone(
  value: string,
  country: string,
): boolean {
  if (value === '') return true;
  if (!validator.isISO31661Alpha2(country)) return false;

  try {
    return isPossiblePhoneNumber(value, country as CountryCode);
  } catch {
    return false;
  }
}

export function phoneNumbersMatch(
  actual: string,
  expected: string,
  country: string,
): boolean {
  if (!validator.isISO31661Alpha2(country)) return false;

  const defaultCountry = country as CountryCode;
  const actualNumber = parsePhoneNumberFromString(actual, defaultCountry);
  const expectedNumber = parsePhoneNumberFromString(expected, defaultCountry);

  return Boolean(
    actualNumber &&
    expectedNumber &&
    actualNumber.number === expectedNumber.number,
  );
}
