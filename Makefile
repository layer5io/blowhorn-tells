# Copyright Layer5, Inc.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

include .github/build/Makefile.show-help.mk

## Install dependencies (Node 24 and corepack).
setup:
	corepack enable && pnpm install --frozen-lockfile

## Run the Worker and its pages locally with Wrangler.
dev:
	pnpm dev

## Syntax check, unit tests and Worker end-to-end tests.
test:
	pnpm test:all

.PHONY: setup dev test
