import { Module } from '@nestjs/common';
import { AmazonAccountAccess } from './amazon-account-access.js';

@Module({ providers: [AmazonAccountAccess], exports: [AmazonAccountAccess] })
export class AmazonAccountAccessModule {}
