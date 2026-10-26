#!/bin/bash
# Account-level hardening for the AWS account that runs Silvicom 360 (AWS-MIGRATION-PLAN.md, D-AWS14
# and the 2026-10-24 audit). OWNER-RUN, on purpose: it changes account settings and the production
# server's alarms, which the auto-mode permission classifier will not let Claude do; Claude wrote and
# reviewed it, the owner runs it once with `!`:
#
#   AWS_PROFILE=silvicom bash infra/aws-account-hardening.sh
#
# Every step is idempotent — a second run finds each thing in place and says so — and every step is
# free or costs cents (the owner's constraint: no added monthly cost):
#
#   1. CloudTrail  — ONE multi-region trail of management events into a new private bucket with a
#                    90-day lifecycle. The first trail's management events are free; the bucket holds
#                    a few MB a month (cents). Without it there is no record of who changed what in
#                    the account — the audit could not even say whether anyone had.
#   2. S3          — Block Public Access at the ACCOUNT level, so no bucket anybody creates later can
#                    be public by mistake. The only bucket today (the storage backup) is already
#                    blocked individually; this covers the next one. Free.
#   3. EBS         — encryption by default for new volumes (the two existing volumes were encrypted by
#                    hand, D-AWS14; this covers a rebuilt server's volume and every snapshot copy). Free.
#   4. CloudWatch  — four alarms (ten are free): StatusCheckFailed_System → EC2 recover (new hardware,
#                    same IP and disk — D-AWS14's "automatic recovery", which the instances' default
#                    maintenance option also does, so this is the alarmed, visible copy of it) and
#                    StatusCheckFailed_Instance → EC2 reboot (the kernel or the OS is wedged; a reboot
#                    is what a person would do, and silvicom-boot.service brings the stack back). Both
#                    also notify an SNS topic the owner subscribes to (email, free). The alarm names
#                    carry the instance id, so a rebuilt server gets new alarms by re-running this.
#   5. Root MFA    — cannot be scripted (AccountMFAEnabled=0 in the audit). Owner: IAM console → root
#                    user → "Assign MFA device". Said at the end, not forgotten.
#
# Declined, because each costs money every month (listed in the PR so the decision is visible):
# GuardDuty (~$4+/mo at this size), VPC Flow Logs (CloudWatch ingestion), AWS Config (per rule
# evaluation), Security Hub, Inspector. Revisit when the fleet or the budget grows.
set -euo pipefail

ACCOUNT=891568748437
REGION=us-west-2
export AWS_DEFAULT_REGION="$REGION"
ALERT_EMAIL="${ALERT_EMAIL:-miki@silvicominc.com}" # ACME_EMAIL in infra/server/*.env; override if wrong
TRAIL=silvicom-management
TRAIL_BUCKET="silvicom360-cloudtrail-$ACCOUNT"
TOPIC=silvicom-alarms
INSTANCES=(i-09fb5a309304be00b i-0f86e0b17f4794168) # production, staging — tagged Project=silvicom360

say() { echo "• $*"; }
who=$(aws sts get-caller-identity --query Account --output text)
[ "$who" = "$ACCOUNT" ] || { echo "signed in to account $who, not $ACCOUNT — stop" >&2; exit 2; }

# ---- 1. CloudTrail -----------------------------------------------------------------------------
if aws s3api head-bucket --bucket "$TRAIL_BUCKET" 2>/dev/null; then
  say "bucket $TRAIL_BUCKET exists"
else
  aws s3api create-bucket --bucket "$TRAIL_BUCKET" --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
  say "created bucket $TRAIL_BUCKET"
fi
# Private, encrypted at rest (SSE-S3 is free), objects expire after 90 days. Put* calls are
# idempotent: the same configuration again is a no-op.
aws s3api put-public-access-block --bucket "$TRAIL_BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket "$TRAIL_BUCKET" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-bucket-lifecycle-configuration --bucket "$TRAIL_BUCKET" --lifecycle-configuration \
  '{"Rules":[{"ID":"expire-90-days","Status":"Enabled","Filter":{"Prefix":""},"Expiration":{"Days":90},
    "AbortIncompleteMultipartUpload":{"DaysAfterInitiation":7}}]}'
# CloudTrail's documented bucket policy: it may check the bucket's ACL and write only its own prefix,
# and only for THIS trail (aws:SourceArn), so no other account's trail can be pointed at the bucket.
trail_arn="arn:aws:cloudtrail:$REGION:$ACCOUNT:trail/$TRAIL"
aws s3api put-bucket-policy --bucket "$TRAIL_BUCKET" --policy "$(cat <<JSON
{"Version":"2012-10-17","Statement":[
 {"Sid":"AWSCloudTrailAclCheck","Effect":"Allow","Principal":{"Service":"cloudtrail.amazonaws.com"},
  "Action":"s3:GetBucketAcl","Resource":"arn:aws:s3:::$TRAIL_BUCKET",
  "Condition":{"StringEquals":{"aws:SourceArn":"$trail_arn"}}},
 {"Sid":"AWSCloudTrailWrite","Effect":"Allow","Principal":{"Service":"cloudtrail.amazonaws.com"},
  "Action":"s3:PutObject","Resource":"arn:aws:s3:::$TRAIL_BUCKET/AWSLogs/$ACCOUNT/*",
  "Condition":{"StringEquals":{"s3:x-amz-acl":"bucket-owner-full-control","aws:SourceArn":"$trail_arn"}}},
 {"Sid":"DenyInsecureTransport","Effect":"Deny","Principal":"*","Action":"s3:*",
  "Resource":["arn:aws:s3:::$TRAIL_BUCKET","arn:aws:s3:::$TRAIL_BUCKET/*"],
  "Condition":{"Bool":{"aws:SecureTransport":"false"}}}
]}
JSON
)"
say "bucket $TRAIL_BUCKET: public access blocked, SSE-S3, 90-day expiry, CloudTrail-only policy"

if aws cloudtrail get-trail --name "$TRAIL" >/dev/null 2>&1; then
  say "trail $TRAIL exists"
else
  # Management events only (the free tier); multi-region so an action in any region is recorded;
  # global service events (IAM, STS) included; log-file validation so a deleted or edited log file
  # is detectable.
  aws cloudtrail create-trail --name "$TRAIL" --s3-bucket-name "$TRAIL_BUCKET" \
    --is-multi-region-trail --include-global-service-events --enable-log-file-validation >/dev/null
  say "created trail $TRAIL (multi-region, management events, validated)"
fi
if [ "$(aws cloudtrail get-trail-status --name "$TRAIL" --query IsLogging --output text)" = "True" ]; then
  say "trail $TRAIL is logging"
else
  aws cloudtrail start-logging --name "$TRAIL"
  say "trail $TRAIL: logging started"
fi

# ---- 2. S3 Block Public Access, account level ---------------------------------------------------
aws s3control put-public-access-block --account-id "$ACCOUNT" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
say "account-level S3 Block Public Access: all four on"

# ---- 3. EBS encryption by default --------------------------------------------------------------
if [ "$(aws ec2 get-ebs-encryption-by-default --query EbsEncryptionByDefault --output text)" = "True" ]; then
  say "EBS encryption by default already on in $REGION"
else
  aws ec2 enable-ebs-encryption-by-default >/dev/null
  say "EBS encryption by default: on in $REGION (new volumes; existing ones were encrypted by hand)"
fi

# ---- 4. CloudWatch alarms on both servers -----------------------------------------------------
# create-topic returns the existing topic's ARN when it already exists; a duplicate subscribe of the
# same endpoint is also a no-op (the owner confirms the email once, by its link).
topic_arn=$(aws sns create-topic --name "$TOPIC" --query TopicArn --output text)
if aws sns list-subscriptions-by-topic --topic-arn "$topic_arn" --query "Subscriptions[?Endpoint=='$ALERT_EMAIL']" --output text | grep -q .; then
  say "topic $TOPIC: $ALERT_EMAIL already subscribed"
else
  aws sns subscribe --topic-arn "$topic_arn" --protocol email --notification-endpoint "$ALERT_EMAIL" >/dev/null
  say "topic $TOPIC: subscription email sent to $ALERT_EMAIL — confirm it from the inbox"
fi
for id in "${INSTANCES[@]}"; do
  env_tag=$(aws ec2 describe-instances --instance-ids "$id" \
    --query 'Reservations[0].Instances[0].Tags[?Key==`Environment`].Value|[0]' --output text)
  # put-metric-alarm replaces an alarm of the same name, so re-running updates rather than duplicates.
  # Two consecutive failed minutes, not one: a single failed check during a reboot we asked for would
  # otherwise recover or reboot a server that is already coming back.
  aws cloudwatch put-metric-alarm --alarm-name "silvicom-$env_tag-$id-system-check" \
    --alarm-description "Silvicom 360 $env_tag server: EC2 system status check failed (hardware/host) — recover to new hardware (D-AWS14)" \
    --namespace AWS/EC2 --metric-name StatusCheckFailed_System --dimensions Name=InstanceId,Value="$id" \
    --statistic Maximum --period 60 --evaluation-periods 2 --threshold 0 --comparison-operator GreaterThanThreshold \
    --treat-missing-data notBreaching \
    --alarm-actions "arn:aws:automate:$REGION:ec2:recover" "$topic_arn" --ok-actions "$topic_arn"
  aws cloudwatch put-metric-alarm --alarm-name "silvicom-$env_tag-$id-instance-check" \
    --alarm-description "Silvicom 360 $env_tag server: EC2 instance status check failed (OS/kernel) — reboot; silvicom-boot.service restarts the stack" \
    --namespace AWS/EC2 --metric-name StatusCheckFailed_Instance --dimensions Name=InstanceId,Value="$id" \
    --statistic Maximum --period 60 --evaluation-periods 3 --threshold 0 --comparison-operator GreaterThanThreshold \
    --treat-missing-data notBreaching \
    --alarm-actions "arn:aws:automate:$REGION:ec2:reboot" "$topic_arn" --ok-actions "$topic_arn"
  say "alarms for $env_tag ($id): system-check → recover, instance-check → reboot, both → $TOPIC"
done

# ---- 5. What only the console can do -----------------------------------------------------------
if [ "$(aws iam get-account-summary --query SummaryMap.AccountMFAEnabled --output text)" = "1" ]; then
  say "root MFA is on"
else
  cat <<'TXT'

⚠ ROOT MFA IS OFF (AccountMFAEnabled=0). This cannot be set from the CLI. Sign in to the console as the
  root user → IAM → "Add MFA" on the root user (an authenticator app on the owner's phone is free).
  Until then every other step above protects an account whose master key has only a password.
TXT
fi
echo "done — re-run any time; nothing above is changed twice."
