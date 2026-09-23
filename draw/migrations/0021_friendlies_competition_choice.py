from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('draw', '0020_realfixtureresult'),
    ]

    operations = [
        migrations.AlterField(
            model_name='season',
            name='competition',
            field=models.CharField(choices=[('UCL', 'UEFA Champions League'), ('LIB', 'Copa Libertadores'), ('SUD', 'Copa Sudamericana'), ('FRN', 'International Friendlies')], default='UCL', max_length=10),
        ),
    ]
