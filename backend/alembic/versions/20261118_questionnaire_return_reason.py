"""单独记录向患者展示的问卷退回原因。"""

import sqlalchemy as sa
from alembic import op

revision = "20261118_questionnaire_return"
down_revision = "20260822_patient_portal"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("assessment_review", sa.Column("return_reason", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("assessment_review", "return_reason")
